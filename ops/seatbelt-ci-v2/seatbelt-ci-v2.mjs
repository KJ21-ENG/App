import {appendFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync, lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// This validator is shared by the v2 helper and the installed workflow entry.
export function validateRequest(value) {
    const keys = (item, names) => item !== null && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).sort().join(',') === names.sort().join(',');
    const sha = (item) => typeof item === 'string' && /^[0-9a-f]{40}$/.test(item);
    const ref = (item, prefix) => typeof item === 'string' && item.startsWith(prefix)
        && /^[A-Za-z0-9_./-]+$/.test(item) && !item.includes('..') && !item.includes('//')
        && !item.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'));
    const required = ['typecheck', 'lint', 'format', 'react-compiler'];
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > 16384 || !keys(value, ['operationId', 'head', 'comparisonBase', 'branch', 'workflow', 'checks', 'jestFiles', 'jestNotApplicable'])
        || typeof value.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.operationId)
        || !sha(value.head) || !sha(value.comparisonBase) || !ref(value.branch, 'refs/heads/')
        || !keys(value.workflow, ['id', 'path', 'ref', 'head', 'digest'])
        || !Number.isSafeInteger(value.workflow.id) || value.workflow.id <= 0
        || value.workflow.path !== '.github/workflows/seatbelt-ci-v2.yml'
        || !ref(value.workflow.ref, 'refs/tags/') || !sha(value.workflow.head)
        || !/^sha256:[0-9a-f]{64}$/.test(value.workflow.digest)
        || !Array.isArray(value.jestFiles) || value.jestFiles.length > 100
        || value.jestFiles.some((path) => typeof path !== 'string' || path.length > 512 || path.startsWith('-')
            || !/^(?:tests\/(?:unit|ui|actions|navigation)\/(?:[A-Za-z0-9_@()-]+\/)*[A-Za-z0-9_@().-]+\.tsx?|[A-Za-z0-9_@().-]+\.(?:test|spec)\.tsx?)$/.test(path))
        || new Set(value.jestFiles).size !== value.jestFiles.length
        || (value.jestFiles.length ? value.jestNotApplicable !== null
            : typeof value.jestNotApplicable !== 'string' || !value.jestNotApplicable.trim() || value.jestNotApplicable.length > 500)
        || !Array.isArray(value.checks) || new Set(value.checks).size !== value.checks.length
        || value.checks.length !== required.length + (value.jestFiles.length ? 1 : 0)
        || !required.every((name) => value.checks.includes(name))
        || value.checks.some((name) => ![...required, ...(value.jestFiles.length ? ['jest'] : [])].includes(name))) {
        throw new Error('Invalid complete Fork CI request');
    }
}

function run(request, candidate, trusted, output) {
    const temporary = mkdtempSync(join(tmpdir(), 'seatbelt-ci-'));
    const env = {PATH: process.env.PATH, HOME: temporary, CI: 'true', GITHUB_BASE_REF: request.comparisonBase,
        NPM_CONFIG_USERCONFIG: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', ESLINT_CONCURRENCY: '1', NODE_OPTIONS: '--max_old_space_size=12288'};
    const git = (cwd, args) => {
        const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], {env, encoding: 'utf8', maxBuffer: 1048576});
        if (result.error || result.status !== 0) throw new Error('Exact checkout or comparison base unavailable');
        return result.stdout.trim();
    };
    const result = {request, repository: {name: process.env.GITHUB_REPOSITORY, id: Number(process.env.GITHUB_REPOSITORY_ID)},
        runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        setup: 'failed', outcomes: []};
    try {
        if (result.repository.name !== 'KJ21-ENG/App'
            || ![result.repository.id, result.runId, result.attempt].every(id => Number.isSafeInteger(id) && id > 0)
            || process.env.GITHUB_WORKFLOW_SHA !== request.workflow.head || process.env.GITHUB_REF !== request.workflow.ref
            || process.env.GITHUB_WORKFLOW_REF !== `${result.repository.name}/${request.workflow.path}@${request.workflow.ref}`
            || git(trusted, ['rev-parse', 'HEAD']) !== request.workflow.head
            || `sha256:${createHash('sha256').update(readFileSync(join(trusted, request.workflow.path))).digest('hex')}` !== request.workflow.digest
            || git(candidate, ['rev-parse', 'HEAD']) !== request.head
            || git(candidate, ['rev-parse', `${request.comparisonBase}^{commit}`]) !== request.comparisonBase) {
            throw new Error('Workflow or tested checkout identity mismatch');
        }
        git(candidate, ['merge-base', '--is-ancestor', request.comparisonBase, request.head]);
        // Upstream Git.getMainBranchCommitHash fetches this exact SHA and resolves origin/<SHA>.
        git(candidate, ['update-ref', `refs/remotes/origin/${request.comparisonBase}`, request.comparisonBase]);
        for (const path of request.jestFiles) {
            const absolute = resolve(candidate, path);
            if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile()
                || !git(candidate, ['ls-files', '--error-unmatch', '--', path])) throw new Error('Missing exact Jest file');
        }
        const npm = (args, childEnv = env) => spawnSync('npm', args, {cwd: candidate, env: childEnv, stdio: 'inherit'});
        const install = npm(['ci']);
        if (install.error || install.status !== 0) throw new Error('Dependency installation failed');
        result.setup = 'passed';
        for (const name of request.checks) {
            const jestOutput = join(temporary, 'jest.json');
            const args = name === 'jest' ? ['test', '--', '--runInBand', '--json', '--outputFile', jestOutput, '--runTestsByPath', ...request.jestFiles]
                : name === 'react-compiler' ? ['run', 'react-compiler-compliance-check', '--', 'check-changed']
                    : ['run', name === 'format' ? 'fmt' : name];
            // Lint can tighten its tracked baseline. Formatting is compared with its own pre-command diff.
            const before = name === 'format' ? git(candidate, ['diff', '--binary', 'HEAD', '--']) : '';
            // Upstream tests CI === 'true'; local diff uses the exact base without PR API context.
            const executed = npm(args, name === 'react-compiler' ? {...env, CI: 'false'} : env);
            let status = executed.error || executed.signal || [126, 127, 137, 143].includes(executed.status) ? 'infrastructure-failure' : executed.status === 0 ? 'passed' : 'code-failure';
            if (name === 'format' && status === 'passed' && git(candidate, ['diff', '--binary', 'HEAD', '--']) !== before) status = 'code-failure';
            if (name === 'jest' && status === 'passed') {
                try {
                    const tests = JSON.parse(readFileSync(jestOutput, 'utf8')).testResults;
                    const names = tests.map(test => test.name).sort();
                    if (JSON.stringify(names) !== JSON.stringify(request.jestFiles.map(path => resolve(candidate, path)).sort())
                        || tests.some(test => !test.assertionResults.some(assertion => assertion.status === 'passed'))) {
                        status = 'infrastructure-failure';
                    }
                } catch {status = 'infrastructure-failure';}
            }
            result.outcomes.push({name, status});
        }
    } catch (error) {
        console.error(error.message);
    } finally {
        writeFileSync(output, JSON.stringify(result));
        rmSync(temporary, {recursive: true, force: true});
    }
    return result.setup === 'passed' && result.outcomes.length === request.checks.length
        && result.outcomes.every(item => item.status === 'passed') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const text = process.env.REQUEST_JSON ?? '';
    if (Buffer.byteLength(text) > 16384) throw new Error('Fork CI request too large');
    const request = JSON.parse(text);
    validateRequest(request);
    if (process.argv[2] === 'prepare') {
        const output = `head=${request.head}\n`;
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
        else process.stdout.write(output);
    } else if (process.argv[2] === 'run' && process.argv.length === 6) {
        process.exitCode = run(request, ...process.argv.slice(3));
    } else throw new Error('Unknown Fork CI command');
}
