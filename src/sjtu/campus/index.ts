// 校园统一身份认证会话：课表、课堂视频、水源共用同一个登录态。
export {
  CampusAuthError,
  campusRequest,
  createCampusLoginWindow,
  flushCampusSession,
  getCampusSession,
  hiddenCampusLogin,
  openCampusLoginWindow,
} from './main/session';
