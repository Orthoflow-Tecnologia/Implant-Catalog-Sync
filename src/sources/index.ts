import type { Source } from '../sync/source.js'
import { anvisaSource } from './anvisa/index.js'
import { geistlichSource } from './geistlich/index.js'
import { implacilSource } from './implacil/index.js'
import { neodentSource } from './neodent/index.js'
import { nobelSource } from './nobel/index.js'
import { sinSource } from './sin/index.js'
import { straumannSource } from './straumann/index.js'

// ANVISA primeiro: a projeção no app usa os registros para preencher o número de cada referência.
export const sources: readonly Source[] = [
  anvisaSource,
  neodentSource,
  straumannSource,
  nobelSource,
  sinSource,
  implacilSource,
  geistlichSource,
]
