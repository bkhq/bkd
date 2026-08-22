import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import attachments from './attachments'
import changes from './changes'
import command from './command'
import create from './create'
import del from './delete'
import duplicate from './duplicate'
import exportRoute from './export'
import importSession from './import-session'
import logs from './logs'
import message from './message'
import query from './query'
import update from './update'

const issues = createOpenAPIRouter()
issues.route('/', query)
issues.route('/', create)
issues.route('/', update)
issues.route('/', del)
issues.route('/', duplicate)
issues.route('/', exportRoute)
issues.route('/', importSession)
issues.route('/', command)
issues.route('/', message)
issues.route('/', attachments)
issues.route('/', logs)
issues.route('/', changes)

// createIssue and followUpIssue use plain .post() because their handlers parse
// both JSON and multipart/form-data manually (auto-validation can't span dual
// content types). Register their route definitions with the OpenAPI registry
// so the generated spec still documents them.
issues.openAPIRegistry.registerPath(R.createIssue)
issues.openAPIRegistry.registerPath(R.followUpIssue)

export default issues
