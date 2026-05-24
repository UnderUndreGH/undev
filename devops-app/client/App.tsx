import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ServerPage } from "./pages/ServerPage.js";
import { AppPage } from "./pages/AppPage.js";
import { EditAppPage } from "./pages/EditAppPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { AuditQueryPage } from "./pages/AuditQueryPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { IncidentPage } from "./pages/IncidentPage.js";
import { IncidentsListPage } from "./pages/IncidentsListPage.js";
import { VpnPage } from "./pages/VpnPage.js";
import { ScriptsPage } from "./pages/ScriptsPage.js";
import { RunDetail } from "./components/scripts/RunDetail.js";
import { Layout } from "./components/layout/Layout.js";
import { ArchivedServersPage } from "./pages/ArchivedServersPage.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/servers/archived" element={<ArchivedServersPage />} />
            <Route path="/servers/:serverId" element={<ServerPage />} />
            <Route path="/apps/:appId" element={<AppPage />} />
            <Route path="/apps/:appId/edit" element={<EditAppPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/audit/query" element={<AuditQueryPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:runId" element={<RunDetail />} />
            <Route path="/incidents" element={<IncidentsListPage />} />
            <Route path="/incidents/:id" element={<IncidentPage />} />
            <Route path="/vpn" element={<VpnPage />} />
            <Route path="/scripts" element={<ScriptsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
