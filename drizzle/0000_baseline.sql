CREATE TABLE IF NOT EXISTS `bookshelves` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kindle_email` text,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`file_path` text NOT NULL,
	`cover_path` text,
	`file_hash` text NOT NULL UNIQUE,
	`source_filename` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`imported_at` integer NOT NULL,
	`reading_status` text DEFAULT 'unread' NOT NULL,
	`rating` real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `book_shelves` (
	`book_id` text NOT NULL,
	`bookshelf_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `bookshelf_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookshelf_id`) REFERENCES `bookshelves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`bookshelf_id` text,
	`recipient_email` text NOT NULL,
	`status` text NOT NULL,
	`smtp_message_id` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookshelf_id`) REFERENCES `bookshelves`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `__irulan_deliveries_migration` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`bookshelf_id` text,
	`recipient_email` text NOT NULL,
	`status` text NOT NULL,
	`smtp_message_id` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookshelf_id`) REFERENCES `bookshelves`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__irulan_deliveries_migration`
SELECT
	`id`,
	`book_id`,
	CASE
		WHEN `bookshelf_id` IS NULL
			OR EXISTS (SELECT 1 FROM `bookshelves` WHERE `bookshelves`.`id` = `deliveries`.`bookshelf_id`)
		THEN `bookshelf_id`
		ELSE NULL
	END,
	`recipient_email`,
	`status`,
	`smtp_message_id`,
	`error_message`,
	`created_at`,
	`sent_at`
FROM `deliveries`;
--> statement-breakpoint
DROP TABLE `deliveries`;
--> statement-breakpoint
ALTER TABLE `__irulan_deliveries_migration` RENAME TO `deliveries`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bookshelves_sort_order_idx` ON `bookshelves` (`sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `books_imported_at_idx` ON `books` (`imported_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `book_shelves_bookshelf_id_added_at_idx` ON `book_shelves` (`bookshelf_id`,`added_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `deliveries_book_id_created_at_idx` ON `deliveries` (`book_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `deliveries_bookshelf_id_created_at_idx` ON `deliveries` (`bookshelf_id`,`created_at`);
--> statement-breakpoint
UPDATE `books`
SET `reading_status` = 'unread'
WHERE `reading_status` IS NULL
	OR `reading_status` NOT IN ('unread', 'reading', 'finished');
--> statement-breakpoint
UPDATE `books`
SET `rating` = NULL
WHERE `rating` IS NOT NULL
	AND (
		`rating` < 0.5
		OR `rating` > 5
		OR `rating` * 2 != CAST(`rating` * 2 AS INTEGER)
	);
--> statement-breakpoint
INSERT INTO `bookshelves` (`id`, `name`, `kindle_email`, `sort_order`, `created_at`)
SELECT
	'default',
	'My bookshelf',
	(SELECT NULLIF(TRIM(`value`), '') FROM `settings` WHERE `key` = 'default_kindle_email'),
	0,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM `bookshelves`);
--> statement-breakpoint
INSERT OR IGNORE INTO `book_shelves` (`book_id`, `bookshelf_id`, `added_at`)
SELECT `books`.`id`, 'default', `books`.`imported_at`
FROM `books`
WHERE EXISTS (SELECT 1 FROM `bookshelves` WHERE `id` = 'default')
	AND NOT EXISTS (
		SELECT 1
		FROM `book_shelves`
		WHERE `book_shelves`.`book_id` = `books`.`id`
	);
