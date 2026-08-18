import React, { useState, useEffect } from 'react';
import { useCSuite } from '../store';
import { Settings, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

export function Integrations() {
  const { company, updateCompany } = useCSuite();
  const [hubspotKey, setHubspotKey] = useState('');
  const [africasTalkingKey, setAfricasTalkingKey] = useState('');
  const [africasTalkingUsername, setAfricasTalkingUsername] = useState('');
  const [africasTalkingVirtualNumber, setAfricasTalkingVirtualNumber] = useState('');
  const [zohoEmail, setZohoEmail] = useState('');
  const [zohoPassword, setZohoPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (company?.integrations) {
      setHubspotKey(company.integrations.hubspotApiKey || '');
      setAfricasTalkingKey(company.integrations.africasTalkingApiKey || '');
      setAfricasTalkingUsername(company.integrations.africasTalkingUsername || '');
      setAfricasTalkingVirtualNumber(company.integrations.africasTalkingVirtualNumber || '');
      setZohoEmail(company.integrations.zohoEmail || '');
      setZohoPassword(company.integrations.zohoPassword || '');
    }
  }, [company]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSaving(true);
    setSuccess(false);
    setError('');

    try {
      await updateCompany({
        integrations: {
          ...company.integrations,
          hubspotApiKey: hubspotKey,
          africasTalkingApiKey: africasTalkingKey,
          africasTalkingUsername: africasTalkingUsername,
          africasTalkingVirtualNumber: africasTalkingVirtualNumber,
          zohoEmail,
          zohoPassword
        }
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to save integrations. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyAT = async () => {
    if (!africasTalkingKey || !africasTalkingUsername) {
      setError('Please enter both API Key and Username to verify.');
      return;
    }
    
    setVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/at/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: africasTalkingKey,
          username: africasTalkingUsername
        })
      });
      
      const data = await res.json();
      if (data.success) {
        alert("API Ping Successful! Your Africa's Talking account should now be verified. Please refresh your Africa's Talking dashboard.");
      } else {
        setError(data.error || 'Failed to ping API');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to ping API');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-50 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">Integrations</h1>
          <p className="text-zinc-500 mt-2">Connect your C-Suite to your real-world tools.</p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">API Keys</h2>
              <p className="text-sm text-zinc-500">Securely store your API keys to enable autonomous agent actions.</p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  HubSpot API Key (Private App Token)
                </label>
                <input
                  type="password"
                  value={hubspotKey}
                  onChange={(e) => setHubspotKey(e.target.value)}
                  placeholder="pat-na1-..."
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono text-sm"
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Used by the CMO to source leads, manage contacts, and send emails.
                </p>
              </div>

              <div className="pt-4 border-t border-zinc-100 space-y-4">
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Africa's Talking Dialer Integration
                </label>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Africa's Talking Username
                    </label>
                    <input
                      type="text"
                      value={africasTalkingUsername}
                      onChange={(e) => setAfricasTalkingUsername(e.target.value)}
                      placeholder="Enter your Africa's Talking username..."
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Africa's Talking API Key
                    </label>
                    <input
                      type="password"
                      value={africasTalkingKey}
                      onChange={(e) => setAfricasTalkingKey(e.target.value)}
                      placeholder="Enter your Africa's Talking API key..."
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Africa's Talking Virtual Number
                    </label>
                    <input
                      type="text"
                      value={africasTalkingVirtualNumber}
                      onChange={(e) => setAfricasTalkingVirtualNumber(e.target.value)}
                      placeholder="e.g., +254711082000"
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-blue-900">Account Not Verified Yet?</h4>
                    <p className="text-xs text-blue-700 mt-1">
                      Africa's Talking requires you to make at least one API call to unlock the Voice dashboard. Click the button to send a dummy API ping.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyAT}
                    disabled={verifying || !africasTalkingKey || !africasTalkingUsername}
                    className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {verifying ? 'Pinging...' : 'Ping API to Verify'}
                  </button>
                </div>

                <p className="text-xs text-zinc-500 mt-2">
                  Used by the CMO to make live outbound calls and pitch your services.
                </p>
              </div>
            </div>

            <div className="pt-6 border-t border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-900 mb-4">Zoho Mail (SMTP)</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Zoho Email Address</label>
                  <input
                    type="email"
                    value={zohoEmail}
                    onChange={(e) => setZohoEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow font-mono text-sm"
                    placeholder="you@zohomail.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">App Password</label>
                  <input
                    type="password"
                    value={zohoPassword}
                    onChange={(e) => setZohoPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow font-mono text-sm"
                    placeholder="Enter your Zoho App Password"
                  />
                  <p className="text-xs text-zinc-500 mt-2">
                    If you have 2FA enabled on Zoho, you must generate an App Password in your Zoho Security settings. Used to send real, designed emails to leads.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-rose-600 bg-rose-50 p-3 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {success && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-emerald-600 bg-emerald-50 p-3 rounded-lg text-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                Integrations saved successfully.
              </motion.div>
            )}

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Integrations'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
