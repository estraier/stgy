export default function LocalImageStudioLoading() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-8">
      <section
        role="status"
        aria-live="polite"
        className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="h-9 w-9 animate-spin rounded-full border-4 border-gray-200 border-t-gray-700"
          />
          <div className="text-sm font-medium text-gray-700">
            Loading Local Image Studio…
          </div>
        </div>
      </section>
    </main>
  );
}
