CREATE TABLE `hiroshi_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`owner_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hiroshi_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hiroshi_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`record` text NOT NULL,
	`models` text NOT NULL,
	`selected` text NOT NULL,
	`verified_at` integer,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hiroshi_devices` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hiroshi_imports` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`private_key` text,
	`payload` text,
	`result` text,
	`record` text,
	`client_id` text,
	`payload_hash` text,
	`expires_at` integer NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hiroshi_rate` (
	`key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL
);
