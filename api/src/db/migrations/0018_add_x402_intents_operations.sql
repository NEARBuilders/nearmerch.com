CREATE TABLE "x402_intents_operations" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"origin_network" text NOT NULL,
	"origin_asset" text NOT NULL,
	"deposit_address" text NOT NULL,
	"deposit_memo" text,
	"facilitator_url" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"fee_plan" jsonb NOT NULL,
	"refund_deadline" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'quoted' NOT NULL,
	"claimed_at" timestamp with time zone,
	"settle_response" jsonb,
	"last_error_reason" text,
	"duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "x402_intents_operations" ADD CONSTRAINT "x402_intents_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x402_intents_operations_order_idx" ON "x402_intents_operations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "x402_intents_operations_state_idx" ON "x402_intents_operations" USING btree ("state");