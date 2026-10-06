-- CreateTable
CREATE TABLE "native_push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "native_push_tokens_token_key" ON "native_push_tokens"("token");

-- CreateIndex
CREATE INDEX "native_push_tokens_userId_idx" ON "native_push_tokens"("userId");

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
