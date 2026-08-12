CREATE TABLE `reader_section_text` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`href` text NOT NULL,
	`label` text NOT NULL,
	`spine_index` integer NOT NULL,
	`text_version` integer NOT NULL,
	`text` text NOT NULL,
	`indexed_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reader_section_text_book_id_href_idx` ON `reader_section_text` (`book_id`,`href`);--> statement-breakpoint
CREATE INDEX `reader_section_text_book_id_spine_index_idx` ON `reader_section_text` (`book_id`,`spine_index`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `reader_section_fts` USING fts5(
	`text`,
	content='reader_section_text',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `reader_section_text_ai` AFTER INSERT ON `reader_section_text` BEGIN
	INSERT INTO `reader_section_fts` (`rowid`, `text`) VALUES (new.`id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `reader_section_text_ad` AFTER DELETE ON `reader_section_text` BEGIN
	INSERT INTO `reader_section_fts` (`reader_section_fts`, `rowid`, `text`)
	VALUES ('delete', old.`id`, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `reader_section_text_au` AFTER UPDATE ON `reader_section_text` BEGIN
	INSERT INTO `reader_section_fts` (`reader_section_fts`, `rowid`, `text`)
	VALUES ('delete', old.`id`, old.`text`);
	INSERT INTO `reader_section_fts` (`rowid`, `text`) VALUES (new.`id`, new.`text`);
END;