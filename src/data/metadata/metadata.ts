import { DatasetMetadata } from '../../domain/models/models'

export const datasetMetadata: DatasetMetadata = {
  name: 'Krishi Mitra Coimbatore Demo Dataset',
  version: '0.1.0',
  region: 'Coimbatore, Tamil Nadu',
  sourceType: 'demo',
  lastUpdated: new Date().toISOString().split('T')[0],
  limitations: [
    'Not scientifically validated for field use',
    'Financials are approximations based on historical averages',
    'Pest data is non-exhaustive',
  ],
}
