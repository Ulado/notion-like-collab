CREATE TABLE `pageCollaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageId` int NOT NULL,
	`userId` int NOT NULL,
	`collaboratorRole` enum('擁有者','編輯者','檢視者') NOT NULL,
	`invitedByUserId` int,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pageCollaborators_id` PRIMARY KEY(`id`),
	CONSTRAINT `page_collaborators_page_user_unique` UNIQUE(`pageId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `pageInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageId` int NOT NULL,
	`invitedByUserId` int NOT NULL,
	`inviteeUserId` int,
	`inviteeEmail` varchar(320) NOT NULL,
	`collaboratorRole` enum('擁有者','編輯者','檢視者') NOT NULL,
	`invitationStatus` enum('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
	`token` varchar(96) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pageInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `page_invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `pagePresence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageId` int NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(96) NOT NULL,
	`activeBlockId` varchar(96),
	`selectionStart` int,
	`selectionEnd` int,
	`lastHeartbeatAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pagePresence_id` PRIMARY KEY(`id`),
	CONSTRAINT `page_presence_session_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `pageVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`snapshotJson` longtext NOT NULL,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pageVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `page_versions_page_version_unique` UNIQUE(`pageId`,`versionNumber`)
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`parentPageId` int,
	`title` varchar(255) NOT NULL,
	`icon` varchar(64),
	`summary` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`depth` int NOT NULL DEFAULT 0,
	`isArchived` int NOT NULL DEFAULT 0,
	`contentJson` longtext NOT NULL,
	`contentVersion` int NOT NULL DEFAULT 1,
	`latestVersionNumber` int NOT NULL DEFAULT 1,
	`lastEditedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `page_collaborators_page_idx` ON `pageCollaborators` (`pageId`);--> statement-breakpoint
CREATE INDEX `page_collaborators_user_idx` ON `pageCollaborators` (`userId`);--> statement-breakpoint
CREATE INDEX `page_invitations_email_idx` ON `pageInvitations` (`inviteeEmail`);--> statement-breakpoint
CREATE INDEX `page_invitations_page_idx` ON `pageInvitations` (`pageId`);--> statement-breakpoint
CREATE INDEX `page_presence_page_idx` ON `pagePresence` (`pageId`);--> statement-breakpoint
CREATE INDEX `page_presence_user_idx` ON `pagePresence` (`userId`);--> statement-breakpoint
CREATE INDEX `page_versions_page_idx` ON `pageVersions` (`pageId`);--> statement-breakpoint
CREATE INDEX `pages_owner_idx` ON `pages` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parentPageId`);--> statement-breakpoint
CREATE INDEX `pages_updated_idx` ON `pages` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `pages_tree_order_idx` ON `pages` (`parentPageId`,`sortOrder`);