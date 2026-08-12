CREATE TABLE `reader_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`section_href` text NOT NULL,
	`text_version` integer NOT NULL,
	`offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`exact` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`color` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_annotations_book_id_section_offset_idx` ON `reader_annotations` (`book_id`,`section_href`,`offset`);--> statement-breakpoint
CREATE INDEX `reader_annotations_book_id_created_at_idx` ON `reader_annotations` (`book_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reader_bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`label` text,
	`section_href` text NOT NULL,
	`text_version` integer NOT NULL,
	`offset` integer NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_bookmarks_book_id_created_at_idx` ON `reader_bookmarks` (`book_id`,`created_at`);