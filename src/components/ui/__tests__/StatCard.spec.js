import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatCard from '../StatCard.vue'

describe('StatCard', () => {
  it('renders label, value, and hint', () => {
    const w = mount(StatCard, {
      props: { label: 'Out of Stock', value: 7, hint: 'Reorder immediately' },
    })
    expect(w.text()).toContain('Out of Stock')
    expect(w.text()).toContain('7')
    expect(w.text()).toContain('Reorder immediately')
  })

  it('shows a placeholder when loading and hides the value', () => {
    const w = mount(StatCard, {
      props: { label: 'Items', value: 12, loading: true },
    })
    // The placeholder element renders instead of the value
    expect(w.find('.placeholder').exists()).toBe(true)
    // And the literal "12" should not appear in the loading state
    expect(w.text()).not.toContain('12')
  })

  it('applies the danger tone class for warnings', () => {
    const w = mount(StatCard, {
      props: { label: 'OOS', value: 3, tone: 'danger', icon: 'ri-error-line' },
    })
    expect(w.find('.bg-danger-subtle').exists()).toBe(true)
  })

  it('omits the icon block when no icon prop is provided', () => {
    const w = mount(StatCard, { props: { label: 'X', value: 1 } })
    expect(w.find('.stat-icon').exists()).toBe(false)
  })
})
