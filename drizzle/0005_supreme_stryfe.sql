CREATE TABLE `reader_progress` (
	`book_id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
