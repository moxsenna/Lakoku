/**
 * Race Condition Harness: Concurrent Claim + Resolution Ordering Proof
 */
import { createClient } from '@/lib/supabase/server'

const CONCURRENCY_LEVEL = 10

async function main(): Promise<void> {
  const db = await createClient()
  
  try {
    // Test concurrent claim: only ONE worker should succeed
    const storyId = `story/race-test-${Date.now()}`
    
    await db
      .from('blueprint_queue')
      .insert({ story_id: storyId, status: 'PENDING' })
      .select()
    
    let successfulClaims = 0
    
    // Simulate concurrent updates - PostgreSQL will handle serialization
    const updatePromises = Array.from({ length: CONCURRENCY_LEVEL }, async (_, i) => {
      const result = await db
        .from('blueprint_queue')
        .update({ 
          status: 'CLAIMED',
          claimed_by: `worker-${i}`,
          claimed_at: new Date().toISOString()
        })
        .eq('story_id', storyId)
        .eq('status', 'PENDING')
        .select('status')
    
      if (result.data?.length === 1) {
        successfulClaims++
      }
      return result
    })
    
    await Promise.all(updatePromises)
    
    console.log(`Concurrent claim test: ${successfulClaims}/${CONCURRENCY_LEVEL} succeeded`)
    if (successfulClaims !== 1) {
      throw new Error(`Race condition detected: multiple claims (${successfulClaims}) succeeded, expected exactly 1`)
    }
    
    // Cleanup
    await db.from('blueprint_queue').delete().eq('story_id', storyId)
    
    console.log('\n✓ All race condition tests PASSED')
  } catch (err) {
    console.error('Race test failed:', err)
    process.exit(1)
  }
}

main().catch(console.error)
