import type { Source } from '../sync/source.js'
import { anvisaSource } from './anvisa/index.js'

export const sources: readonly Source[] = [anvisaSource]
