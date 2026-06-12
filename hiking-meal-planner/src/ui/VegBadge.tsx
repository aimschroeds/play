export function VegBadge({ vegetarian }: { vegetarian: boolean }) {
  return vegetarian ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      veg
    </span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
      non-veg
    </span>
  )
}
