import { findCoursesTool } from './canvas/find-courses';
import { searchSourcesTool } from './canvas/search-sources';
import { syncSourcesTool } from './canvas/sync-sources';
import { writeNoteTool } from './common/edit';
import { readResourceTool } from './common/read-resource';
import { prepareEmailTool } from './mail/prepare-email';
import { searchMailTool } from './mail/search-mail';
import { createEventTool } from './timetable/create-event';
import { queryScheduleTool } from './timetable/query-schedule';
import { queryAssignmentsTool, queryTodosTool } from './todo/query';
import { refreshTodosTool } from './todo/refresh';
import { saveTodoTool } from './todo/save';
import { copyFileToProjectTool } from './workspace/copy-file';
import { createEntryTool, updateEntryTool } from './workspace/entries';
import { linkSourceTool } from './workspace/link-source';
import { searchWorkspaceTool } from './workspace/search-workspace';
import { fetchPageTool } from './web/fetch-page';
import { webSearchTool } from './web/web-search';

export const agentTools = {
  prepare_email: prepareEmailTool,
  query_schedule: queryScheduleTool,
  query_todos: queryTodosTool,
  save_todo: saveTodoTool,
  refresh_todos: refreshTodosTool,
  query_assignments: queryAssignmentsTool,
  search_mail: searchMailTool,
  find_courses: findCoursesTool,
  sync_sources: syncSourcesTool,
  search_sources: searchSourcesTool,
  search_workspace: searchWorkspaceTool,
  web_search: webSearchTool,
  fetch_page: fetchPageTool,
  read_resource: readResourceTool,
  create_entry: createEntryTool,
  update_entry: updateEntryTool,
  write_note: writeNoteTool,
  link_source: linkSourceTool,
  copy_file_to_project: copyFileToProjectTool,
  create_event: createEventTool,
};
