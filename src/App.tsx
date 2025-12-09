import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ComposedChart, Area } from 'recharts';
import { Settings, Info, MapPin } from 'lucide-react';

const TDOALocalization = () => {
  const [params, setParams] = useState({
    snr1: -10,
    processingGain: 30,
    bandwidth: 10e6,
    cpi: 0.1,
    pfa: 1e-6,
    trials: 1000,
    numReceivers: 4
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState('detection');

  const calcPostCorrSNR = (snr1_db, snr2_db, pg_db) => {
    const snr1_lin = Math.pow(10, snr1_db / 10);
    const snr2_lin = Math.pow(10, snr2_db / 10);
    const pg_lin = Math.pow(10, pg_db / 10);
    if (snr1_lin < 0.01 && snr2_lin < 0.01) {
      const snr_out_lin = snr1_lin * snr2_lin * pg_lin;
      return 10 * Math.log10(Math.max(1e-20, snr_out_lin));
    } else {
      const snr_out_lin = (snr1_lin * snr2_lin * pg_lin) / (1 + snr1_lin + snr2_lin);
      return 10 * Math.log10(Math.max(1e-20, snr_out_lin));
    }
  };

  const erfcinv = (x) => {
    if (x >= 2) return -100;
    if (x <= 0) return 100;
    const a = 0.147;
    const ln_term = Math.log(x * (2 - x));
    const first = 2 / (Math.PI * a) + ln_term / 2;
    const second = ln_term / a;
    const sign = x < 1 ? 1 : -1;
    return sign * Math.sqrt(Math.abs(-first + Math.sqrt(first * first - second)));
  };

  const erf = (x) => {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  };

  const erfc = (x) => 1 - erf(x);

  const calcDetectionProb = (snr_post_db, pfa) => {
    const snr_post = Math.pow(10, snr_post_db / 10);
    const qinv_pfa = Math.sqrt(2) * erfcinv(2 * pfa);
    const qinv_pd = qinv_pfa - Math.sqrt(2 * snr_post);
    const pd = 0.5 * erfc(qinv_pd / Math.sqrt(2));
    return Math.max(pfa, Math.min(0.9999, pd));
  };

  const calcCRLB_delay = (snr_post_db, bandwidth) => {
    const snr_post = Math.pow(10, snr_post_db / 10);
    const beta = bandwidth / Math.sqrt(12);
    const sigma_tau_sq = 1 / (8 * Math.PI * Math.PI * beta * beta * snr_post);
    return Math.sqrt(sigma_tau_sq);
  };

  const calcDetectionCI = (pd, trials) => {
    const z = 1.96;
    const denom = 1 + z * z / trials;
    const center = (pd + z * z / (2 * trials)) / denom;
    const width = z * Math.sqrt((pd * (1 - pd) / trials + z * z / (4 * trials * trials))) / denom;
    return { lower: Math.max(0, center - width), upper: Math.min(1, center + width) };
  };

  const calcGDOP = (numRx) => {
    if (numRx === 3) return 3.5;
    if (numRx === 4) return 2.5;
    if (numRx === 5) return 2.0;
    if (numRx >= 6) return 1.5;
    return 3.0;
  };

  const calcTDOAPositionError = (sigma_tau, gdop) => {
    const c = 3e8;
    return gdop * c * sigma_tau;
  };

  const calcCEP = (sigma) => {
    return 0.589 * 2 * sigma;
  };

  const generateDetectionData = () => {
    const data = [];
    for (let snr = -35; snr <= 0; snr += 1) {
      const snr_post = calcPostCorrSNR(snr, snr, params.processingGain);
      const pd = calcDetectionProb(snr_post, params.pfa);
      const ci = calcDetectionCI(pd, params.trials);
      data.push({ snr, snr_post, pd, pd_lower: ci.lower, pd_upper: ci.upper });
    }
    return data;
  };

  const generatePositionErrorData = () => {
    const data = [];
    for (let snr = -35; snr <= 0; snr += 1) {
      const snr_post = calcPostCorrSNR(snr, snr, params.processingGain);
      const sigma_tau = calcCRLB_delay(snr_post, params.bandwidth);
      const gdop = calcGDOP(params.numReceivers);
      const position_error = calcTDOAPositionError(sigma_tau, gdop);
      const cep = calcCEP(position_error);
      data.push({
        snr,
        snr_post,
        position_error_1sigma: position_error,
        position_error_95: 1.96 * position_error,
        cep: cep
      });
    }
    return data;
  };

  const generateGDOPImpactData = () => {
    const data = [];
    const snr_fixed = params.snr1;
    const snr_post = calcPostCorrSNR(snr_fixed, snr_fixed, params.processingGain);
    const sigma_tau = calcCRLB_delay(snr_post, params.bandwidth);
    for (let numRx = 3; numRx <= 8; numRx++) {
      const gdop = calcGDOP(numRx);
      const pos_error = calcTDOAPositionError(sigma_tau, gdop);
      const cep = calcCEP(pos_error);
      data.push({ numReceivers: numRx, gdop: gdop, position_error: pos_error, cep: cep });
    }
    return data;
  };

  const generate2DErrorEllipse = () => {
    const snr_levels = [-30, -25, -20, -15, -10, -5];
    const ellipses = [];
    snr_levels.forEach(snr => {
      const snr_post = calcPostCorrSNR(snr, snr, params.processingGain);
      const sigma_tau = calcCRLB_delay(snr_post, params.bandwidth);
      const gdop = calcGDOP(params.numReceivers);
      const sigma_pos = calcTDOAPositionError(sigma_tau, gdop);
      const points = [];
      const scale = 1.96;
      for (let angle = 0; angle <= 2 * Math.PI; angle += Math.PI / 20) {
        points.push({
          x: sigma_pos * scale * Math.cos(angle) / 1000,
          y: sigma_pos * scale * Math.sin(angle) / 1000,
          snr: snr
        });
      }
      ellipses.push({ snr, points, sigma: sigma_pos });
    });
    return ellipses;
  };

  const detectionData = generateDetectionData();
  const positionErrorData = generatePositionErrorData();
  const gdopImpactData = generateGDOPImpactData();
  const errorEllipses = generate2DErrorEllipse();

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg text-sm">
          {data.snr !== undefined && <p className="font-semibold">Pre-Corr SNR: {data.snr} dB</p>}
          {data.numReceivers !== undefined && <p className="font-semibold">Receivers: {data.numReceivers}</p>}
          {data.snr_post !== undefined && <p className="text-purple-600">Post-Corr SNR: {data.snr_post.toFixed(1)} dB</p>}
          {data.pd !== undefined && <p className="text-blue-600">P_D: {(data.pd * 100).toFixed(2)}%</p>}
          {data.position_error_1sigma !== undefined && <p className="text-green-600">Position Error (1σ): {data.position_error_1sigma.toFixed(1)} m</p>}
          {data.gdop !== undefined && <p className="text-indigo-600">GDOP: {data.gdop.toFixed(2)}</p>}
          {data.position_error !== undefined && <p className="text-green-600">Position Error: {data.position_error.toFixed(1)} m</p>}
          {data.cep !== undefined && <p className="text-orange-600">CEP: {data.cep.toFixed(1)} m</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-50 to-indigo-50 p-6 overflow-auto">
      <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
              <MapPin className="text-indigo-600" size={32} />
              TDOA Transmitter Localization
            </h1>
            <p className="text-gray-600">Multi-Receiver Position Estimation for Spread Spectrum Signals</p>
          </div>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <Settings size={20} />
            Settings
          </button>
        </div>

        {showSettings && (
          <div className="mb-6 p-5 bg-gradient-to-r from-gray-50 to-indigo-50 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-800 mb-4">System Configuration</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Average RX SNR (dB)</label>
                <input type="number" value={params.snr1} onChange={(e) => setParams({...params, snr1: parseFloat(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded" min="-35" max="0" step="1" />
                <p className="text-xs text-gray-500 mt-1">Pre-correlation SNR</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Processing Gain (dB)</label>
                <input type="number" value={params.processingGain} onChange={(e) => setParams({...params, processingGain: parseFloat(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded" min="10" max="60" step="1" />
                <p className="text-xs text-gray-500 mt-1">SS gain</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of Receivers</label>
                <input type="number" value={params.numReceivers} onChange={(e) => setParams({...params, numReceivers: parseInt(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded" min="3" max="8" step="1" />
                <p className="text-xs text-gray-500 mt-1">Min 3 for 2D</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bandwidth (MHz)</label>
                <input type="number" value={params.bandwidth / 1e6} onChange={(e) => setParams({...params, bandwidth: parseFloat(e.target.value) * 1e6})} className="w-full px-3 py-2 border border-gray-300 rounded" min="1" max="100" step="1" />
              </div>
            </div>
            <div className="p-3 bg-indigo-100 rounded text-sm">
              <p className="font-medium text-indigo-900">Current GDOP: {calcGDOP(params.numReceivers).toFixed(2)}</p>
              <p className="text-indigo-800">Post-Corr SNR: {calcPostCorrSNR(params.snr1, params.snr1, params.processingGain).toFixed(1)} dB</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { id: 'detection', label: 'Detection' },
            { id: 'position', label: 'Position Error' },
            { id: 'gdop', label: 'GDOP Impact' },
            { id: 'ellipse', label: 'Error Ellipses' }
          ].map(view => (
            <button key={view.id} onClick={() => setActiveView(view.id)} className={`px-4 py-2 rounded-lg font-medium transition ${activeView === view.id ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
              {view.label}
            </button>
          ))}
        </div>

        {activeView === 'detection' && (
          <div>
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={detectionData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="snr" label={{ value: 'Pre-Correlation SNR (dB)', position: 'insideBottom', offset: -10 }} stroke="#666" />
                <YAxis yAxisId="left" label={{ value: 'P_D', angle: -90, position: 'insideLeft' }} domain={[0, 1]} tickFormatter={(v) => `${(v*100).toFixed(0)}%`} stroke="#2563eb" />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'Post-Corr SNR (dB)', angle: 90, position: 'insideRight' }} stroke="#7c3aed" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="pd_upper" stroke="none" fill="#3b82f6" fillOpacity={0.2} />
                <Area yAxisId="left" type="monotone" dataKey="pd_lower" stroke="none" fill="#fff" fillOpacity={1} />
                <Line yAxisId="left" type="monotone" dataKey="pd" stroke="#2563eb" strokeWidth={3} dot={false} name="P_D" />
                <Line yAxisId="right" type="monotone" dataKey="snr_post" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Post-Corr SNR" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">Detection Performance</h3>
              <p className="text-sm">Detection must succeed before localization is possible</p>
              <p className="text-blue-700 font-medium text-sm mt-2">Current P_D: {(calcDetectionProb(calcPostCorrSNR(params.snr1, params.snr1, params.processingGain), params.pfa) * 100).toFixed(1)}%</p>
            </div>
          </div>
        )}

        {activeView === 'position' && (
          <div>
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={positionErrorData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="snr" label={{ value: 'Pre-Correlation SNR (dB)', position: 'insideBottom', offset: -10 }} stroke="#666" />
                <YAxis scale="log" label={{ value: 'Position Error (m)', angle: -90, position: 'insideLeft' }} domain={['auto', 'auto']} tickFormatter={(v) => v.toExponential(1)} stroke="#16a34a" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="position_error_1sigma" stroke="#16a34a" strokeWidth={3} dot={false} name="Position Error (1σ)" />
                <Line type="monotone" dataKey="position_error_95" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="95% Confidence" />
                <Line type="monotone" dataKey="cep" stroke="#f59e0b" strokeWidth={2} dot={false} name="CEP (50%)" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 rounded-lg">
                <h3 className="font-semibold text-green-900 mb-2">Position Error</h3>
                <p className="text-sm">Receivers: {params.numReceivers}</p>
                <p className="text-sm">GDOP: {calcGDOP(params.numReceivers).toFixed(2)}</p>
                <p className="text-green-700 font-medium text-sm mt-1">
                  1σ: {calcTDOAPositionError(calcCRLB_delay(calcPostCorrSNR(params.snr1, params.snr1, params.processingGain), params.bandwidth), calcGDOP(params.numReceivers)).toFixed(1)} m
                </p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <h3 className="font-semibold text-orange-900 mb-2">CEP</h3>
                <p className="text-sm">50% probability circle</p>
                <p className="text-orange-700 font-medium text-sm mt-1">
                  {calcCEP(calcTDOAPositionError(calcCRLB_delay(calcPostCorrSNR(params.snr1, params.snr1, params.processingGain), params.bandwidth), calcGDOP(params.numReceivers))).toFixed(1)} m
                </p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg">
                <h3 className="font-semibold text-blue-900 mb-2">Formula</h3>
                <p className="text-xs">σ_pos = GDOP x c x σ_τ</p>
                <p className="text-xs mt-1">CEP = 0.589(σ_x + σ_y)</p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'gdop' && (
          <div>
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={gdopImpactData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="numReceivers" label={{ value: 'Number of Receivers', position: 'insideBottom', offset: -10 }} stroke="#666" />
                <YAxis yAxisId="left" label={{ value: 'GDOP', angle: -90, position: 'insideLeft' }} stroke="#7c3aed" />
                <YAxis yAxisId="right" orientation="right" scale="log" label={{ value: 'Position Error (m)', angle: 90, position: 'insideRight' }} stroke="#16a34a" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="gdop" stroke="#7c3aed" strokeWidth={3} dot={true} name="GDOP" />
                <Line yAxisId="right" type="monotone" dataKey="position_error" stroke="#16a34a" strokeWidth={3} dot={true} name="Position Error" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-4 p-4 bg-purple-50 rounded-lg">
              <h3 className="font-semibold text-purple-900 mb-2">GDOP Impact</h3>
              <p className="text-sm">Lower GDOP means better receiver geometry and more accurate positioning</p>
              <p className="text-purple-700 font-medium text-sm mt-2">
                3 RX: GDOP = 3.5 | 4 RX: GDOP = 2.5 | 5+ RX: GDOP = 1.5-2.0
              </p>
            </div>
          </div>
        )}

        {activeView === 'ellipse' && (
          <div>
            <ResponsiveContainer width="100%" height={500}>
              <ScatterChart margin={{ top: 20, right: 30, left: 60, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis type="number" dataKey="x" label={{ value: 'Position Error X (km)', position: 'insideBottom', offset: -10 }} stroke="#666" />
                <YAxis type="number" dataKey="y" label={{ value: 'Position Error Y (km)', angle: -90, position: 'insideLeft' }} stroke="#666" />
                <Tooltip />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {errorEllipses.map((ellipse, idx) => (
                  <Scatter
                    key={ellipse.snr}
                    name={`SNR = ${ellipse.snr} dB (σ = ${(ellipse.sigma/1000).toFixed(2)} km)`}
                    data={ellipse.points}
                    fill={`hsl(${idx * 60}, 70%, 50%)`}
                    line={{ stroke: `hsl(${idx * 60}, 70%, 40%)`, strokeWidth: 2 }}
                    shape="circle"
                  />
                ))}
                <Scatter name="True Position" data={[{ x: 0, y: 0 }]} fill="#000" shape="cross" />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-4 p-4 bg-red-50 rounded-lg">
              <h3 className="font-semibold text-red-900 mb-2">95% Confidence Ellipses</h3>
              <p className="text-sm">Each ellipse shows the 95% confidence region for different SNR levels</p>
              <p className="text-sm">True transmitter position at center. Ellipses shrink as SNR improves.</p>
              <p className="text-sm font-medium text-red-700 mt-2">Current system at {params.snr1} dB: Position error = {calcTDOAPositionError(calcCRLB_delay(calcPostCorrSNR(params.snr1, params.snr1, params.processingGain), params.bandwidth), calcGDOP(params.numReceivers)).toFixed(1)} m (1σ)</p>
            </div>
          </div>
        )}

        <div className="mt-6 p-4 bg-indigo-50 rounded-lg">
          <h3 className="font-semibold text-indigo-900 mb-2">Key TDOA Equations</h3>
          <div className="text-sm space-y-1">
            <p>Position Error: σ_pos = GDOP x c x σ_τ</p>
            <p>Time Delay CRLB: σ_τ = 1 / (2π x β x sqrt(2 x SNR_post))</p>
            <p>CEP (50% circle): 0.589(σ_x + σ_y)</p>
            <p>R95 (95% circle): 2.45 x σ</p>
          </div>
        </div>

        <div className="mt-4 p-5 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-l-4 border-indigo-600">
          <h3 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
            <Info size={20} />
            Processing Gain and CAF Correlator Samples
          </h3>
          <div className="text-sm text-gray-700 space-y-3">
            <div>
              <p className="font-semibold text-indigo-800 mb-1">Processing Gain Definition:</p>
              <p className="font-mono text-xs bg-white p-2 rounded mb-1">PG = T_obs × B_signal = N_samples / f_sample × B_signal</p>
              <p>Where T_obs is observation time, B_signal is signal bandwidth, and N_samples is number of samples</p>
            </div>
            
            <div>
              <p className="font-semibold text-indigo-800 mb-1">For Spread Spectrum Systems:</p>
              <p className="font-mono text-xs bg-white p-2 rounded mb-1">PG_dB = 10 × log10(B_spread / R_data) = 10 × log10(N_chips)</p>
              <p>Example: DSSS with 1023-chip spreading code gives PG = 10×log10(1023) ≈ 30 dB</p>
            </div>

            <div>
              <p className="font-semibold text-indigo-800 mb-1">CAF Correlator Implementation:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>N_samples = T_obs × f_sample</strong>: Total samples collected during observation</li>
                <li><strong>Coherent Integration</strong>: Cross-correlating all N samples provides the full processing gain</li>
                <li><strong>Current System</strong>: CPI = {(params.cpi * 1000).toFixed(0)} ms, BW = {(params.bandwidth/1e6).toFixed(0)} MHz → N ≈ {((params.cpi * params.bandwidth)/1e6).toFixed(0)}M samples</li>
                <li><strong>Processing Gain</strong>: PG = {params.processingGain} dB = {Math.pow(10, params.processingGain/10).toFixed(0)}× power improvement</li>
              </ul>
            </div>

            <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
              <p className="font-semibold text-yellow-900 mb-1">Key Insight:</p>
              <p>The CAF correlates <strong>all N samples</strong> from both receivers. For a spread spectrum signal buried {Math.abs(params.snr1)} dB below noise, the correlation process:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 mt-1">
                <li>Aligns the signal components coherently (adds constructively)</li>
                <li>Noise remains uncorrelated between receivers (adds incoherently)</li>
                <li>Result: Post-correlation SNR increases by the processing gain</li>
                <li><strong>Example</strong>: {params.snr1} dB + {params.processingGain} dB PG ≈ {calcPostCorrSNR(params.snr1, params.snr1, params.processingGain).toFixed(1)} dB (accounting for dual-receiver geometry)</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-indigo-800 mb-1">Practical Considerations:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Memory</strong>: Storing {((params.cpi * params.bandwidth)/1e9).toFixed(2)}G samples × 2 receivers requires significant buffer memory</li>
                <li><strong>Computation</strong>: 2D FFT-based CAF computation: O(N log N) per delay-Doppler bin</li>
                <li><strong>Trade-off</strong>: Longer CPI (more samples) gives better PG but assumes signal coherence over T_obs</li>
                <li><strong>Doppler Limitation</strong>: CPI must be short enough that Doppler shift is constant (typically T_obs &lt; 1/(f_doppler_rate))</li>
              </ul>
            </div>

            <div className="bg-green-50 p-3 rounded border border-green-200">
              <p className="font-semibold text-green-900 mb-1">Bottom Line:</p>
              <p>Processing Gain = {params.processingGain} dB means your CAF correlator must process <strong>{Math.pow(10, params.processingGain/10).toFixed(0)} times</strong> as many samples as you would need for a narrowband signal. This is why spread spectrum enables LPI (Low Probability of Intercept) communication - the signal is spread across a wide bandwidth and can only be recovered by a receiver that knows the spreading code and integrates over the full observation time.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TDOALocalization;