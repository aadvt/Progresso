CREATE TABLE `concept_mastery` (
	`student_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`state` text NOT NULL,
	`stability` real,
	`difficulty` real,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review_at` text,
	`due_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`student_id`, `concept_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mastery_due_idx` ON `concept_mastery` (`student_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `concept_prerequisites` (
	`concept_id` text NOT NULL,
	`prerequisite_id` text NOT NULL,
	PRIMARY KEY(`concept_id`, `prerequisite_id`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prerequisite_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prereq_reverse_idx` ON `concept_prerequisites` (`prerequisite_id`);--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`name` text NOT NULL,
	`class` integer NOT NULL,
	`unit_id` text NOT NULL,
	`chapter` text NOT NULL,
	`aliases` text NOT NULL,
	`graph_fingerprint` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `concepts_subject_idx` ON `concepts` (`subject`);--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`graph_fingerprint` text NOT NULL,
	`engine_version` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnoses_student_idx` ON `diagnoses` (`student_id`);--> statement-breakpoint
CREATE TABLE `error_record_concepts` (
	`error_record_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`confidence` real NOT NULL,
	`role` text NOT NULL,
	`mapped_by` text NOT NULL,
	`graph_fingerprint` text,
	PRIMARY KEY(`error_record_id`, `concept_id`),
	FOREIGN KEY (`error_record_id`) REFERENCES `error_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `erc_concept_idx` ON `error_record_concepts` (`concept_id`);--> statement-breakpoint
CREATE TABLE `error_records` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` text NOT NULL,
	`student_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`report_id` text,
	`question_ref` text NOT NULL,
	`diagnosis_text` text NOT NULL,
	`error_type` text NOT NULL,
	`error_type_original` text,
	`student_working` text,
	`marks_lost` real,
	`marks_max` real,
	`misconception_id` text,
	`provenance_kind` text NOT NULL,
	`record` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `error_records_student_idx` ON `error_records` (`student_id`);--> statement-breakpoint
CREATE INDEX `error_records_exam_idx` ON `error_records` (`exam_id`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`date` text NOT NULL,
	`max_marks` real,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exams_student_idx` ON `exams` (`student_id`,`date`);--> statement-breakpoint
CREATE TABLE `graph_versions` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`source_dir` text NOT NULL,
	`stats` text NOT NULL,
	`loaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `misconceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`description` text NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`target_concept_id` text,
	`status` text NOT NULL,
	`planned_minutes` integer DEFAULT 25 NOT NULL,
	`plan` text,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `missions_student_day_idx` ON `missions` (`student_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`exam_id` text,
	`source_path` text NOT NULL,
	`sha256` text NOT NULL,
	`received_at` text NOT NULL,
	`parser_name` text,
	`parser_version` text,
	`status` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`mission_id` text,
	`rating` integer NOT NULL,
	`correct` integer NOT NULL,
	`detail` text,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_log_student_concept_idx` ON `review_log` (`student_id`,`concept_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`class` integer NOT NULL,
	`subjects` text NOT NULL,
	`next_exam_name` text,
	`next_exam_date` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`name` text NOT NULL,
	`class` integer NOT NULL,
	`board_marks` real NOT NULL
);
