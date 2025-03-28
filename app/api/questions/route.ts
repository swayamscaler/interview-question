import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ParsedRow } from '@/lib/types';
import { findTopK } from '@/lib/vector-similarity';
import { processAllQuestions } from '@/lib/questions-service';
import { supabase } from '@/lib/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate embedding for search query
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float"
  });
  
  return response.data[0].embedding;
}

function isValidUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company') || '';
    const role = searchParams.get('role') || '';
    const query = searchParams.get('query') || '';
    const processQuestions = searchParams.get('process') === 'true';

    // If processing is requested, run it first
    if (processQuestions) {
      await processAllQuestions();
    }

    // Fetch total count first
    const { count, error: countError } = await supabase
      .from('interviews')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error("Error getting total count:", countError);
      return NextResponse.json([], { status: 500 });
    }

    // Paginate through all records
    const pageSize = 1000;
    const totalPages = Math.ceil(count! / pageSize);
    let questionsData: any[] = [];

    for (let page = 0; page < totalPages; page++) {
      const { data: pageData, error: pageError } = await supabase
        .from('interviews')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) {
        console.error("Error fetching questions:", pageError);
        return NextResponse.json([], { status: 500 });
      }

      questionsData = questionsData.concat(pageData || []);
    }


    const filteredRows = questionsData
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

    const questions = filteredRows.map((row: ParsedRow) => ({
      id: row['Question ID'],
      question: row['Formatted Question'] || row['Question Text'],
      originalQuestion: row['Question Text'],
      questionUrl: isValidUrl(row['Question Text']) ? row['Question Text'] : undefined,
      answer: row['Answer Text'] || undefined,
      company: row['Company'],
      role: row['Role']
    }));

    // Use vector search if query is provided
    if (query) {
      try {
        const queryVector = await generateEmbedding(query);
        
        // Get stored embeddings
        const storedEmbeddings = new Map<string, number[]>();
        for (const row of filteredRows) {
          if (row['Embedding']) {
            try {
              storedEmbeddings.set(row['Question ID'], JSON.parse(row['Embedding']));
            } catch (error) {
              console.error(`Error parsing embedding for question ${row['Question ID']}:`, error);
            }
          }
        }

        // Convert stored embeddings to format needed by findTopK
        const vectors = Array.from(storedEmbeddings.entries()).map(([id, vector]) => ({
          id,
          vector
        }));

        const similarQuestions = findTopK(queryVector, vectors, 50);

        // Filter and sort results
        const results = similarQuestions
          .map(({ id, similarity }) => {
            const question = questions.find(q => q.id === id);
            if (!question) return null;

            const companyMatch = company ? question.company.toLowerCase().includes(company.toLowerCase()) : true;
            const roleMatch = role ? question.role.toLowerCase().includes(role.toLowerCase()) : true;

            if (!companyMatch && !roleMatch) return null;

            return {
              ...question,
              matchType: companyMatch && roleMatch ? 'exact' : companyMatch ? 'company' : 'role',
              similarity
            };
          })
          .filter(Boolean);

        return NextResponse.json(results, { status: 200 });
      } catch (error) {
        console.error("Error in vector search:", error);
        return NextResponse.json([], { status: 500 });
      }
    } else {
      // Traditional company/role filtering without vector search
      const results = questions
        .map(q => ({
          ...q,
          matchType: company && role && 
            q.company.toLowerCase().includes(company.toLowerCase()) && 
            q.role.toLowerCase().includes(role.toLowerCase())
            ? 'exact'
            : company && q.company.toLowerCase().includes(company.toLowerCase())
            ? 'company'
            : 'role'
        }))
        .filter(q => {
          const companyMatch = company ? q.company.toLowerCase().includes(company.toLowerCase()) : true;
          const roleMatch = role ? q.role.toLowerCase().includes(role.toLowerCase()) : true;
          return companyMatch || roleMatch;
        });

      return NextResponse.json(results, { status: 200 });
    }
  } catch (error) {
    console.error("Error loading questions:", error);
    return NextResponse.json([], { status: 500 });
  }
}
