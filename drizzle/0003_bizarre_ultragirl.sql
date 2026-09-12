DROP INDEX `reader_annotations_book_id_section_offset_idx`;--> statement-breakpoint
-- Recolouring a passage used to insert a second annotation over the same range.
-- Carry any note the extra rows held onto the row that survives.
UPDATE `reader_annotations` SET `note` = (
	SELECT `dup`.`note`
	FROM `reader_annotations` AS `dup`
	WHERE `dup`.`book_id` = `reader_annotations`.`book_id`
		AND `dup`.`section_href` = `reader_annotations`.`section_href`
		AND `dup`.`text_version` = `reader_annotations`.`text_version`
		AND `dup`.`offset` = `reader_annotations`.`offset`
		AND `dup`.`end_offset` = `reader_annotations`.`end_offset`
		AND `dup`.`note` IS NOT NULL
	ORDER BY `dup`.`updated_at` DESC, `dup`.`rowid` DESC
	LIMIT 1
) WHERE `note` IS NULL;--> statement-breakpoint
-- Keep the most recently touched annotation for each anchored range.
DELETE FROM `reader_annotations` WHERE `rowid` NOT IN (
	SELECT `rowid` FROM (
		SELECT
			`rowid`,
			ROW_NUMBER() OVER (
				PARTITION BY `book_id`, `section_href`, `text_version`, `offset`, `end_offset`
				ORDER BY `updated_at` DESC, `created_at` DESC, `rowid` DESC
			) AS `dedupe_rank`
		FROM `reader_annotations`
	) WHERE `dedupe_rank` = 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `reader_annotations_book_id_range_idx` ON `reader_annotations` (`book_id`,`section_href`,`text_version`,`offset`,`end_offset`);
