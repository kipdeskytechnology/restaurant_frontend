import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBadge from '../StatusBadge.vue'

describe('StatusBadge', () => {
  it('renders slot content', () => {
    const w = mount(StatusBadge, { slots: { default: 'Available' } })
    expect(w.text()).toBe('Available')
  })

  it('applies the success tone classes', () => {
    const w = mount(StatusBadge, {
      props: { tone: 'success' },
      slots: { default: 'OK' },
    })
    expect(w.classes()).toContain('bg-success-subtle')
    expect(w.classes()).toContain('text-success-emphasis')
  })

  it('falls back to default tone when none specified', () => {
    const w = mount(StatusBadge, { slots: { default: 'Hi' } })
    expect(w.classes()).toContain('bg-secondary-subtle')
  })

  it('drops the rounded-pill when pill=false', () => {
    const w = mount(StatusBadge, {
      props: { pill: false },
      slots: { default: 'Hi' },
    })
    expect(w.classes()).not.toContain('rounded-pill')
  })
})
