import { FarmProfile } from '../../domain/models/models'

export const demoProfile: FarmProfile = {
  ph: 7.8, // Slightly alkaline
  nitrogenKgPerAcre: 45, // Moderate
  phosphorusKgPerAcre: 30, // Moderate
  potassiumKgPerAcre: 15, // Low (Groundnut needs more)
  soilType: 'Sandy Loam',
  region: 'Coimbatore',
  acres: 2,
  currentMonth: 6, // June is suitable for Kharif Groundnut
}
