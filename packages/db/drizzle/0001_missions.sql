CREATE TABLE `plan_settings` (
	`student_id` text PRIMARY KEY NOT NULL,
	`exam_name` text NOT NULL,
	`exam_date` text NOT NULL,
	`daily_minutes` integer NOT NULL,
	`start_date` text NOT NULL,
	`demo_day_offset` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` text NOT NULL,
	`mission_id` text,
	`question_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`target_misconception_id` text,
	`answer` text NOT NULL,
	`correct` integer NOT NULL,
	`revealed_misconception_id` text,
	`answered_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_attempts_student_idx` ON `question_attempts` (`student_id`,`answered_at`);--> statement-breakpoint
CREATE INDEX `question_attempts_mission_idx` ON `question_attempts` (`mission_id`);--> statement-breakpoint
DROP INDEX `missions_student_day_idx`;--> statement-breakpoint
ALTER TABLE `missions` ADD `slot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `work_key` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `result` text;--> statement-breakpoint
CREATE UNIQUE INDEX `missions_student_day_slot_idx` ON `missions` (`student_id`,`scheduled_for`,`slot`);--> statement-breakpoint
ALTER TABLE `concept_mastery` ADD `card` text;--> statement-breakpoint
ALTER TABLE `concept_mastery` ADD `proven_at` text;