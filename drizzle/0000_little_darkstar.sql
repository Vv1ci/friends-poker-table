CREATE TABLE `poker_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_user_id` text NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_poker_rooms_updated_at` ON `poker_rooms` (`updated_at`);