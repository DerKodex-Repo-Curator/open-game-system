import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Collective from "./pages/Collective";
import Index from "./pages/Index";
import Join from "./pages/Join";
import NotFound from "./pages/NotFound";
import Open from "./pages/Open";
import Play from "./pages/Play";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/collective" element={<Collective />} />
          <Route path="/play/:appId" element={<Play />} />
          <Route path="/open" element={<Open />} />
          <Route path="/join" element={<Join />} />
          <Route path="/join/:code" element={<Join />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
