CREATE TABLE `team` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`lead_session_id` text NOT NULL,
	`status` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_team_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `team_member` (
	`id` text PRIMARY KEY,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`session_id` text NOT NULL,
	`agent` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`directory` text,
	`branch` text,
	`last_error` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_team_member_team_id_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `team_task` (
	`id` text PRIMARY KEY,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`owner` text,
	`deps` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_team_task_team_id_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_project_name_idx` ON `team` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `team_lead_session_idx` ON `team` (`lead_session_id`);--> statement-breakpoint
CREATE INDEX `team_project_status_idx` ON `team` (`project_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_team_name_idx` ON `team_member` (`team_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_session_idx` ON `team_member` (`session_id`);--> statement-breakpoint
CREATE INDEX `team_member_team_status_idx` ON `team_member` (`team_id`,`status`);--> statement-breakpoint
CREATE INDEX `team_task_team_status_idx` ON `team_task` (`team_id`,`status`);
