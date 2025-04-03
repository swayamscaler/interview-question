import OpenAI from 'openai';
import type { ParsedRow } from './types';
import { supabase } from './supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Format question using GPT-4
async function formatQuestionWithAI(question: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an assistant that identifies the fundamental concepts in interview questions. Extract the core question being asked, removing any unnecessary context or verbosity. Your response should still be in question format. Do not use any markdown formatting in your response. Keep your response simple, direct, and focused on what's being tested."
        },
        {
          role: "user",
          content: `Analyze this interview question and return only its core concept as a clear, direct question without any markdown: "${question}"`
        }
      ]
    });

    return completion.choices[0].message.content || question;
  } catch (error) {
    console.error("Error formatting question with OpenAI:", error);
    return question;
  }
}

// Generate embedding for a question using OpenAI
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float"
  });
  
  return response.data[0].embedding;
}

// Process a single question: format and generate embedding
async function processQuestion(
  question: string, 
  existingFormattedQuestion?: string
): Promise<{
  formattedQuestion: string;
  embedding: number[];
}> {
  // If we already have a formatted question, skip the API call
  const formattedQuestion = existingFormattedQuestion || await formatQuestionWithAI(question);
  const embedding = await generateEmbedding(formattedQuestion);
  return { formattedQuestion, embedding };
}

// Read questions from Supabase
async function readQuestions(): Promise<ParsedRow[]> {
  const { data, error } = await supabase
    .from('interviews')
    .select('*')
    .limit(1000);

  if (error) {
    console.error("Error reading questions from Supabase:", error);
    throw error;
  }

  return (data || [])
    .filter(row => row && row.question_id !== null && row.question_id !== undefined)
    .map(row => ({
      'Question ID': row.question_id.toString(),
      'Question Text': row.question_text || '',
      'Answer Text': row.answer_text || '',
      'Company': row.company || '',
      'Role': row.role || '',
      'Formatted Question': row.formatted_question || '',
      'Embedding': row.embedding || null
    }));
}

// Update question in Supabase
async function updateQuestion(row: ParsedRow): Promise<void> {
  const { error } = await supabase
    .from('interviews')
    .update({
      question_text: row['Question Text'],
      answer_text: row['Answer Text'],
      company: row['Company'],
      role: row['Role'],
      formatted_question: row['Formatted Question'],
      embedding: row['Embedding']
    })
    .eq('question_id', parseInt(row['Question ID']));

  if (error) {
    console.error("Error updating question in Supabase:", error);
    throw error;
  }
}

// Process all questions in the CSV
export async function processAllQuestions({ 
  onProgress 
}: { 
  onProgress?: (status: string) => Promise<void> 
} = {}) {
  const rows = await readQuestions();
  const processedRows: ParsedRow[] = [];

  const totalQuestions = rows.length;
  const batchSize = 5; // Process 5 questions at a time to avoid rate limits
  
  if (onProgress) {
    await onProgress(`Found ${totalQuestions} questions to process`);
  }
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(rows.length / batchSize);
    
    if (onProgress) {
      await onProgress(`Processing batch ${batchNumber}/${totalBatches} (${i + 1}-${Math.min(i + batchSize, rows.length)} of ${totalQuestions} questions)`);
    }
    const processedBatch = await Promise.all(
      batch.map(async (row) => {
        // Skip if already processed and has embedding
        if (row['Formatted Question'] && row['Embedding']) {
          if (onProgress) {
            await onProgress(`Skipping already processed question with ID ${row['Question ID']} (has formatted question and embedding)`);
          }
          return row;
        }

        const question = row['Question Text'];
        if (!question) return row;

        // Skip URLs
        if (question.startsWith('http')) {
          return {
            ...row,
            'Formatted Question': question,
            'Embedding': '[]' // Empty embedding for URLs
          };
        }

        try {
          // Pass existing formatted question if available
          const { formattedQuestion, embedding } = await processQuestion(
            question,
            row['Formatted Question'] // Will be undefined if not present
          );
          
          if (row['Formatted Question'] && onProgress) {
            await onProgress(`Generating new embedding using existing formatted question for ID ${row['Question ID']}`);
          } else if (onProgress) {
            await onProgress(`Formatting and generating embedding for ID ${row['Question ID']}`);
          }
          return {
            ...row,
            'Formatted Question': formattedQuestion,
            'Embedding': JSON.stringify(Array.from(embedding))
          };
        } catch (error) {
          console.error(`Error processing question ${row['Question ID']}:`, error);
          return row;
        }
      })
    );

    processedRows.push(...processedBatch);
    
    // Update processed questions in batch
    await Promise.all(processedBatch.map(row => updateQuestion(row)));
    
    if (onProgress) {
      const processed = processedRows.length;
      const remaining = totalQuestions - processed;
      await onProgress(`Progress: ${processed}/${totalQuestions} questions processed (${remaining} remaining)`);
    }
    
    // Add a small delay between batches to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (onProgress) {
    await onProgress("All questions processed successfully!");
  }
  return processedRows;
}

// Get embeddings from CSV
export async function getStoredEmbeddings(): Promise<Map<string, number[]>> {
  const rows = await readQuestions();
  const embeddings = new Map<string, number[]>();

  for (const row of rows) {
    if (row['Embedding']) {
      try {
        embeddings.set(row['Question ID'], JSON.parse(row['Embedding']));
      } catch (error) {
        console.error(`Error parsing embedding for question ${row['Question ID']}:`, error);
      }
    }
  }

  return embeddings;
}
