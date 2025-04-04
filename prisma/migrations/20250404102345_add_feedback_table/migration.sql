-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "suggestion" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "email" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
