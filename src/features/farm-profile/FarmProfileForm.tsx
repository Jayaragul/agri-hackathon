import React, { useState } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { FarmProfileSchema } from '../../domain/schemas/schemas'
import { ArrowRight } from 'lucide-react'

const FarmProfileForm: React.FC = () => {
  const { profile, setProfile, loadDemoProfile } = useFarmStore()
  
  const [formData, setFormData] = useState({
    ph: profile?.ph?.toString() || '',
    nitrogenKgPerAcre: profile?.nitrogenKgPerAcre?.toString() || '',
    phosphorusKgPerAcre: profile?.phosphorusKgPerAcre?.toString() || '',
    potassiumKgPerAcre: profile?.potassiumKgPerAcre?.toString() || '',
    soilType: profile?.soilType || '',
    region: profile?.region || '',
    acres: profile?.acres?.toString() || '1',
    currentMonth: profile?.currentMonth?.toString() || (new Date().getMonth() + 1).toString()
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    const parsed = {
      ph: parseFloat(formData.ph),
      nitrogenKgPerAcre: parseFloat(formData.nitrogenKgPerAcre),
      phosphorusKgPerAcre: parseFloat(formData.phosphorusKgPerAcre),
      potassiumKgPerAcre: parseFloat(formData.potassiumKgPerAcre),
      soilType: formData.soilType,
      region: formData.region,
      acres: parseFloat(formData.acres),
      currentMonth: parseInt(formData.currentMonth, 10)
    }

    const validation = FarmProfileSchema.safeParse(parsed)
    
    if (!validation.success) {
      const newErrors: Record<string, string> = {}
      validation.error.issues.forEach(issue => {
        if (issue.path[0]) {
          newErrors[issue.path[0].toString()] = issue.message
        }
      })
      setErrors(newErrors)
      return
    }

    setProfile(validation.data)
  }

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Soil Analysis</span>
      </div>
      
      <h2 style={{ marginBottom: '24px' }}>
        Tell us about your <span className="gradient-text gradient-underline">Farm</span>
      </h2>

      <div className="card">
        <div className="alert alert-info demo-alert">
          <div>
            <div className="alert-title">Demo Mode Available</div>
            <div className="alert-desc">
              Load the pre-configured demo profile to see how the engine differentiates between optimal and risky crops.
            </div>
          </div>
          <button 
            type="button" 
            className="btn btn-secondary demo-button" 
            style={{ padding: '0 16px', height: '36px', fontSize: '14px', marginLeft: 'auto' }}
            onClick={loadDemoProfile}
          >
            Load Demo
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            {/* Soil Health */}
            <div className="form-group">
              <label htmlFor="ph">Soil pH</label>
              <input 
                type="number" 
                step="0.1" 
                id="ph" 
                name="ph" 
                className="form-control" 
                value={formData.ph} 
                onChange={handleChange} 
                placeholder="e.g. 6.5" 
              />
              {errors.ph && <span className="hint" style={{color: 'red'}}>{errors.ph}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="nitrogenKgPerAcre">Available Nitrogen</label>
              <div className="input-with-unit">
                <input 
                  type="number" 
                  id="nitrogenKgPerAcre" 
                  name="nitrogenKgPerAcre" 
                  className="form-control" 
                  value={formData.nitrogenKgPerAcre} 
                  onChange={handleChange} 
                  placeholder="e.g. 80" 
                />
                <span className="input-unit">kg/ac</span>
              </div>
              {errors.nitrogenKgPerAcre && <span className="hint" style={{color: 'red'}}>{errors.nitrogenKgPerAcre}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="phosphorusKgPerAcre">Available Phosphorus</label>
              <div className="input-with-unit">
                <input 
                  type="number" 
                  id="phosphorusKgPerAcre" 
                  name="phosphorusKgPerAcre" 
                  className="form-control" 
                  value={formData.phosphorusKgPerAcre} 
                  onChange={handleChange} 
                  placeholder="e.g. 40" 
                />
                <span className="input-unit">kg/ac</span>
              </div>
              {errors.phosphorusKgPerAcre && <span className="hint" style={{color: 'red'}}>{errors.phosphorusKgPerAcre}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="potassiumKgPerAcre">Available Potassium</label>
              <div className="input-with-unit">
                <input 
                  type="number" 
                  id="potassiumKgPerAcre" 
                  name="potassiumKgPerAcre" 
                  className="form-control" 
                  value={formData.potassiumKgPerAcre} 
                  onChange={handleChange} 
                  placeholder="e.g. 40" 
                />
                <span className="input-unit">kg/ac</span>
              </div>
              {errors.potassiumKgPerAcre && <span className="hint" style={{color: 'red'}}>{errors.potassiumKgPerAcre}</span>}
            </div>

            {/* Farm Details */}
            <div className="form-group">
              <label htmlFor="soilType">Soil Type</label>
              <select 
                id="soilType" 
                name="soilType" 
                className="form-control" 
                value={formData.soilType} 
                onChange={handleChange}
              >
                <option value="">Select soil type...</option>
                <option value="Red Calcareous Soil">Red Calcareous Soil</option>
                <option value="Black Soil">Black Soil</option>
                <option value="Alluvial and Colluvial Soil">Alluvial and Colluvial Soil</option>
                <option value="Red Non-Calcareous Soil">Red Non-Calcareous Soil</option>
                <option value="Forest Soil">Forest Soil</option>
                <option value="Irugur Series">Irugur Series</option>
                <option value="Palladam Series">Palladam Series</option>
                <option value="Somayanur Series">Somayanur Series</option>
                <option value="Brown Soil">Brown Soil</option>
              </select>
              {errors.soilType && <span className="hint" style={{color: 'red'}}>{errors.soilType}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="region">Region / District</label>
              <select 
                id="region" 
                name="region" 
                className="form-control" 
                value={formData.region} 
                onChange={handleChange}
              >
                <option value="">Select region...</option>
                <option value="Coimbatore">Coimbatore</option>
                <option value="Pollachi">Pollachi</option>
                <option value="Tiruppur">Tiruppur</option>
                <option value="Mettupalayam">Mettupalayam</option>
              </select>
              {errors.region && <span className="hint" style={{color: 'red'}}>{errors.region}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="acres">Land Size</label>
              <div className="input-with-unit">
                <input 
                  type="number" 
                  step="0.1" 
                  id="acres" 
                  name="acres" 
                  className="form-control" 
                  value={formData.acres} 
                  onChange={handleChange} 
                />
                <span className="input-unit">Acres</span>
              </div>
              {errors.acres && <span className="hint" style={{color: 'red'}}>{errors.acres}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="currentMonth">Sowing Month</label>
              <select 
                id="currentMonth" 
                name="currentMonth" 
                className="form-control" 
                value={formData.currentMonth} 
                onChange={handleChange}
              >
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="5">May</option>
                <option value="6">June</option>
                <option value="7">July</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary mobile-full-button" style={{ marginTop: '24px', width: 'auto' }}>
            Get Crop Recommendations <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}

export default FarmProfileForm
