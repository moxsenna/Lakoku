import assert from 'node:assert/strict'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

assert.equal(normalizeStoryRouteId('demo%3Aselasa-akhir'), 'demo:selasa-akhir')
assert.equal(normalizeStoryRouteId('demo:selasa-akhir'), 'demo:selasa-akhir')
assert.equal(normalizeStoryRouteId('fixture%3Awarisan-terkubur'), 'fixture:warisan-terkubur')
assert.equal(normalizeStoryRouteId('%E0%A4%A'), '%E0%A4%A')

console.log('story-route-id smoke PASS')
