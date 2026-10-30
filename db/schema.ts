import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pokerRooms = sqliteTable(
  "poker_rooms",
  {
    code: text("code").primaryKey(),
    hostUserId: text("host_user_id").notNull(),
    stateJson: text("state_json").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_poker_rooms_updated_at").on(table.updatedAt)],
);
