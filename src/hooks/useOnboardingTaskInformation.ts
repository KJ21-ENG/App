import ONYXKEYS from '@src/ONYXKEYS';
import type {IntroSelectedTask} from '@src/types/onyx/IntroSelected';
import isLoadingOnyxValue from '@src/types/utils/isLoadingOnyxValue';
import useHasOutstandingChildTask from './useHasOutstandingChildTask';
import useOnyx from './useOnyx';
import useParentReportAction from './useParentReportAction';
import useReportIsArchived from './useReportIsArchived';

function useOnboardingTaskInformation(taskName: IntroSelectedTask) {
    const [introSelected, introSelectedResult] = useOnyx(ONYXKEYS.NVP_INTRO_SELECTED);
    const taskReportID = introSelected?.[taskName];
    const [taskReport, taskReportResult] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${taskReportID}`, undefined, [taskReportID]);
    const [taskParentReport] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${taskReport?.parentReportID}`);
    const hasOutstandingChildTask = useHasOutstandingChildTask(taskReport);
    const isOnboardingTaskParentReportArchived = useReportIsArchived(taskParentReport?.reportID);
    const parentReportAction = useParentReportAction(taskReport);
    const isLoadingIntroSelected = isLoadingOnyxValue(introSelectedResult);
    const isLoadingTaskReport = isLoadingIntroSelected || (!!taskReportID && isLoadingOnyxValue(taskReportResult));

    return {
        taskReportID,
        taskReport,
        taskParentReport,
        isOnboardingTaskParentReportArchived,
        hasOutstandingChildTask,
        parentReportAction,
        isLoadingTaskReport,
    };
}

export default useOnboardingTaskInformation;
