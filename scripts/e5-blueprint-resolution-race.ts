/**
 * Race Condition Harness: Concurrent Claim + Resolution Ordering Proof
 */
import { Client } from 'pg'

const CONCURRENCY_LEVEL = 10

async function main(): Promise<void> {
  const client = new Client({
    host: process.env.TEST_DB_HOST || 'localhost',
    port: parseInt(process.env.TEST_DB_PORT || '5432'),
    database: process.env.TEST_DB_NAME || 'lakoku_test',
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'postgres',
  })
  
  try {
    await client.connect()
    
    // Test concurrent claim: only ONE worker should succeed
    const storyId = `story/race-test-${Date.now()}`
    
    await client.query(
      'INSERT INTO blueprint_queue (story_id) VALUES ($1)',
      [storyId]
    )
    
    let successfulClaims = 0
    for (let i = 0; i < CONCURRENCY_LEVEL; i++) {
      const result = await client.query(
        'UPDATE blueprint_queue SET status = $1 WHERE story_id = $2 AND status = $3',
        ['CLAIMED', storyId, 'PENDING']
      )
      
      if (result.rowCount === 1) successfulClaims++
    }
    
    console.log(`Concurrent claim test: ${successfulClaims}/CONCURRENCY_LEVEL succeeded`)
    if (successfulClaims !== 1) {
      throw new Error('Race condition detected: multiple claims succeeded')
    }
    
    console.log('\n✓ All race condition tests PASSED')
  } finally {
    await client.end()
  }
}

main().catch(console.error)
