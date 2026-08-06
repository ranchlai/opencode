CREATE TABLE `memory` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`tool` text NOT NULL,
	`key` text NOT NULL,
	`error` text NOT NULL,
	`input` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_project_key_idx` ON `memory` (`project_id`,`key`);