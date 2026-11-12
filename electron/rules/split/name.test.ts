import { describe, expect, it } from 'vitest'
import { jobName } from './name'

describe('jobName', () => {
  it('takes the most common leading word of the exported names', () => {
    expect(jobName(['parseRules', 'parseLine', 'ruleLine'], [])).toEqual({ name: 'parse' })
    expect(jobName(['FileTree'], ['FileTree'])).toEqual({ name: 'file' })
    expect(jobName(['HTTPServer'], [])).toEqual({ name: 'http' })
  })

  it('breaks a tie by the leading words of every member, then by any word of theirs', () => {
    expect(jobName(['startReview', 'toggleReview'], ['startReview', 'toggleReview', 'toggleOne'])).toEqual({ name: 'toggle' })
    expect(jobName(['fileDiff', 'stageFile', 'unstageFile'], ['fileDiff', 'stageFile', 'unstageFile'])).toEqual({ name: 'file' })
  })

  it('names the tie instead of guessing when nothing settles it', () => {
    expect(jobName(['alignChanges', 'toHunks'], ['alignChanges', 'toHunks'])).toEqual({ unnamed: 'the leading words of the exported names tie: align x1, to x1' })
  })

  it('reads the own part of a dotted name and skips default exports', () => {
    expect(jobName(['Store.loadAll'], [])).toEqual({ name: 'load' })
    expect(jobName(['default'], ['default'])).toEqual({ unnamed: 'no exported name has a word to name the job after' })
    expect(jobName(['default', 'renderPage'], [])).toEqual({ name: 'render' })
    expect(jobName(['_', '$'], [])).toEqual({ unnamed: 'no exported name has a word to name the job after' })
  })
})
