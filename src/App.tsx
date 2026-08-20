/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CSuiteProvider } from './store';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { Team } from './pages/Team';
import { Boardroom } from './pages/Boardroom';
import { Goals } from './pages/Goals';
import { Integrations } from './pages/Integrations';
import { Resolutions } from './pages/Resolutions';

export default function App() {
  return (
    <CSuiteProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/team" element={<Team />} />
            <Route path="/boardroom" element={<Boardroom />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/resolutions" element={<Resolutions />} />
            <Route path="/integrations" element={<Integrations />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </CSuiteProvider>
  );
}

