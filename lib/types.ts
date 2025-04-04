export interface WebsiteFeedbackSubmission {
  suggestion: string
  rating: number
  email: string
}

export interface WebsiteFeedback extends WebsiteFeedbackSubmission {
  id: string
  timestamp: number
}

export interface Comment {
  id: string
  text: string
  author: string
  timestamp: number
}

export interface QuestionData {
  id: string
  question: string
  originalQuestion?: string
  questionUrl?: string
  answer?: string
  company: string
  role: string
}

export interface Question extends QuestionData {
  matchType: "exact" | "company" | "role"
  similarity?: number // Similarity score from vector comparison
  keywords?: string[]
  comments?: Comment[]
}

export interface ParsedRow {
  'Question ID': string
  'Question Text': string
  'Answer Text'?: string
  'Company': string
  'Role': string
  'Formatted Question'?: string
  'Embedding'?: string  // Store embeddings as JSON string
  [key: string]: string | undefined
}
