CREATE TABLE `session_loop` (
	`session_id` text PRIMARY KEY,
	`goal` text NOT NULL,
	`started` integer NOT NULL,
	`deadline` integer,
	`max` integer,
	`rounds` integer NOT NULL,
	`verify` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
