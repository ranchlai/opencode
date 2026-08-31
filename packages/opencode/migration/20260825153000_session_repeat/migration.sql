CREATE TABLE `session_repeat` (
	`session_id` text PRIMARY KEY,
	`goal` text NOT NULL,
	`template` text,
	`items_path` text,
	`phase` text NOT NULL,
	`cursor` integer NOT NULL,
	`rounds` integer NOT NULL,
	`started` integer NOT NULL,
	`deadline` integer,
	`max` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_repeat_item` (
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`child_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	PRIMARY KEY(`session_id`, `position`)
);
--> statement-breakpoint
CREATE INDEX `repeat_item_session_status_idx` ON `session_repeat_item` (`session_id`,`status`);
