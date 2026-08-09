import React, { useEffect, useState } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { FarmProfileSchema } from '../../domain/schemas/schemas'
import { getSessionStorage } from '../../services/storage'
import type { FarmProfile } from '../../domain/models/models'
import { ArrowRight, FileText, History, Loader2, Upload } from 'lucide-react'
import { getSoilReportExtractor } from '../../services/ai'

const FarmProfileForm: React.FC = () => {
  const { profile, labReport, setLabReport, setProfile, loadDemoProfile } = useFarmStore()
  const [savedProfile, setSavedProfile] = useState<FarmProfile | null>(null)
  const [reportStatus, setReportStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [reportMessage, setReportMessage] = useState<string | null>(null)

  useEffect(() => {
    if (profile) return
    let cancelled = false
    getSessionStorage()
      .loadSnapshot()
      .then((snapshot) => {
        if (!cancelled && snapshot?.farmProfile) setSavedProfile(snapshot.farmProfile)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [profile])

  const [formData, setFormData] = useState({
    ph: profile?.ph?.toString() || labReport?.ph?.toString() || '',
    nitrogenKgPerAcre: profile?.nitrogenKgPerAcre?.toString() || labReport?.nitrogenKgPerAcre?.toString() || '',
    phosphorusKgPerAcre: profile?.phosphorusKgPerAcre?.toString() || labReport?.phosphorusKgPerAcre?.toString() || '',
    potassiumKgPerAcre: profile?.potassiumKgPerAcre?.toString() || labReport?.potassiumKgPerAcre?.toString() || '',
    soilType: profile?.soilType || '',
    region: profile?.region || '',
    acres: profile?.acres?.toString() || '1',
    currentMonth: profile?.currentMonth?.toString() || (new Date().getMonth() + 1).toString()
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleReportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReportStatus('uploading')
    setReportMessage(null)
    const outcome = await getSoilReportExtractor().extractDetailed(file)
    if (!outcome.data.documentRecognised) {
      setReportStatus('error')
      setReportMessage(outcome.data.warnings[0] || 'This file was not recognised as a soil report.')
      return
    }
    setLabReport(outcome.data)
    setFormData(prev => ({
      ...prev,
      ph: outcome.data.ph === null ? prev.ph : String(outcome.data.ph),
      nitrogenKgPerAcre: outcome.data.nitrogenKgPerAcre === null ? prev.nitrogenKgPerAcre : String(outcome.data.nitrogenKgPerAcre),
      phosphorusKgPerAcre: outcome.data.phosphorusKgPerAcre === null ? prev.phosphorusKgPerAcre : String(outcome.data.phosphorusKgPerAcre),
      potassiumKgPerAcre: outcome.data.potassiumKgPerAcre === null ? prev.potassiumKgPerAcre : String(outcome.data.potassiumKgPerAcre),
    }))
    setReportStatus('success')
    setReportMessage(outcome.data.warnings.length > 0 ? outcome.data.warnings.join(' ') : 'Soil values imported. Complete the remaining farm details below.')
  }

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
        <div className="soil-report-upload">
          <input id="soil-report-file" type="file" accept="image/*,.pdf,application/pdf" capture="environment" onChange={handleReportChange} style={{ display: 'none' }} />
          <label htmlFor="soil-report-file" className="soil-report-upload-button">
            {reportStatus === 'uploading' ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            {reportStatus === 'uploading' ? 'Reading soil report…' : 'Upload Soil Health Card (photo or PDF)'}
          </label>
          <p className="soil-report-upload-hint"><FileText size={15} /> pH, N, P and K will be read automatically. No manual entry needed.</p>
          {reportMessage && <p className={`soil-report-upload-message ${reportStatus === 'error' ? 'is-error' : ''}`}>{reportMessage}</p>}
        </div>

        {savedProfile && (
          <div className="alert alert-info">
            <div>
              <div className="alert-title">Welcome back</div>
              <div className="alert-desc">
                We found your last farm profile on this device. Resume it instead of typing it in again?
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0 16px', height: '36px', fontSize: '14px', marginLeft: 'auto' }}
              onClick={() => setProfile(savedProfile)}
            >
              <History size={14} style={{ marginRight: '6px' }} /> Resume
            </button>
          </div>
        )}
        <div className="alert alert-info">
          <div>
            <div className="alert-title">Demo Mode Available</div>
            <div className="alert-desc">
              Load the pre-configured demo profile to see how the engine differentiates between optimal and risky crops.
            </div>
          </div>
          <button 
            type="button" 
            className="btn btn-secondary" 
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
                readOnly
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
                  readOnly
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
                  readOnly
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
                  readOnly
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
                <option value="Red Soil">Red Soil</option>
                <option value="Black Soil">Black Soil</option>
                <option value="Sandy Loam">Sandy Loam</option>
                <option value="Heavy Clay">Heavy Clay</option>
                <option value="Light Black Soil">Light Black Soil</option>
                <option value="Red Calcareous Soil">Red Calcareous Soil</option>
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

          <button type="submit" className="btn btn-primary" style={{ marginTop: '24px', width: 'auto' }}>
            Get Crop Recommendations <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}

export default FarmProfileForm
