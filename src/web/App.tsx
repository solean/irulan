import { Route, Routes } from "react-router-dom";

import { Shell } from "./app/shell";
import { ThemeProvider } from "./hooks/use-theme";
import { ToastProvider } from "./hooks/use-toast";
import { BookDetailPage } from "./pages/BookDetailPage";
import { BookshelfPage } from "./pages/BookshelfPage";
import { BookshelvesPage } from "./pages/BookshelvesPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SettingsPage } from "./pages/SettingsPage";

const AppRoutes = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route element={<BookshelfPage />} path="/" />
      <Route element={<BookDetailPage />} path="/books/:bookId" />
      <Route element={<ReaderPage />} path="/books/:bookId/read" />
      <Route element={<BookshelvesPage />} path="/bookshelves" />
      <Route element={<SettingsPage />} path="/settings" />
    </Route>
  </Routes>
);

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </ThemeProvider>
  );
}
