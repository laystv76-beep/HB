CREATE TABLE `storeSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`whatsappPhone` varchar(32),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeSettings_id` PRIMARY KEY(`id`)
);
