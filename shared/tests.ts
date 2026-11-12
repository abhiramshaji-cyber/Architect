const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

export const isTestFile = (file: string): boolean => TEST_FILE.test(file)
