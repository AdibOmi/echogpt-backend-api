-- AlterTable
ALTER TABLE "api_usage_logs" ADD COLUMN     "route" TEXT;

-- CreateIndex
CREATE INDEX "api_usage_logs_route_idx" ON "api_usage_logs"("route");

-- Search suggestions use prefix matching: WHERE normalized_query LIKE 'nes%'.
-- A normal btree index can't serve LIKE under a non-"C" collation; the
-- text_pattern_ops operator class makes prefix LIKE queries use the index.
CREATE INDEX "web_searches_normalized_query_prefix_idx"
  ON "web_searches" ("normalized_query" text_pattern_ops);
