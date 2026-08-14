import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"

export const TeamTable = sqliteTable(
  "team",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    lead_session_id: text().$type<SessionID>().notNull(),
    status: text().notNull(),
    delegate: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("team_project_name_idx").on(table.project_id, table.name),
    index("team_lead_session_idx").on(table.lead_session_id),
    index("team_project_status_idx").on(table.project_id, table.status),
  ],
)

export const TeamMemberTable = sqliteTable(
  "team_member",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    session_id: text().$type<SessionID>().notNull(),
    agent: text().notNull(),
    provider_id: text(),
    model_id: text(),
    role: text().notNull(),
    status: text().notNull(),
    directory: text(),
    branch: text(),
    last_error: text(),
    plan_approval: text().notNull().default("none"),
    heartbeat_at: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("team_member_team_name_idx").on(table.team_id, table.name),
    uniqueIndex("team_member_session_idx").on(table.session_id),
    index("team_member_team_status_idx").on(table.team_id, table.status),
  ],
)

export const TeamTaskTable = sqliteTable(
  "team_task",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    status: text().notNull(),
    owner: text(),
    deps: text({ mode: "json" }).$type<string[]>().notNull(),
    ...Timestamps,
  },
  (table) => [index("team_task_team_status_idx").on(table.team_id, table.status)],
)
