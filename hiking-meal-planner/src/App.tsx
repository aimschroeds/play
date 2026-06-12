import { useState } from 'react'
import { ItemsPage } from './ui/ItemsPage'
import { MealsPage } from './ui/MealsPage'

const TABS = ['Items', 'Meals'] as const
type Tab = (typeof TABS)[number]

function App() {
  const [tab, setTab] = useState<Tab>('Items')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-8 px-6 py-4">
          <h1 className="text-lg font-bold text-emerald-800">Hiking Trip Meal Planner</h1>
          <nav className="flex gap-4">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  t === tab
                    ? 'border-b-2 border-emerald-700 font-medium text-emerald-800'
                    : 'text-gray-500 hover:text-gray-800'
                }
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">
        {tab === 'Items' ? <ItemsPage /> : <MealsPage />}
      </main>
    </div>
  )
}

export default App
