ALTER TABLE `team_member` ADD `plan_approval` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_member` ADD `heartbeat_at` integer;--> statement-breakpoint
ALTER TABLE `team` ADD `delegate` integer DEFAULT 0 NOT NULL;