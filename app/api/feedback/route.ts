import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { WebsiteFeedbackSubmission } from "@/lib/types"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { suggestion, rating, email }: WebsiteFeedbackSubmission = body

    const feedback = await prisma.feedback.create({
      data: {
        suggestion,
        rating,
        email,
      },
    })

    return NextResponse.json({ success: true, feedback })
  } catch (error) {
    console.error("Error saving feedback:", error)
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    )
  }
}
